package com.xwiggy.food.dao;

import com.xwiggy.food.model.Food;
import com.xwiggy.food.model.Order;
import com.xwiggy.food.model.OrderItem;
import com.xwiggy.food.model.OrderLineRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;

/**
 * Replaces the old single-row `cart` table hack (quantity1..quantity6 columns keyed by
 * position) with a real per-user order history. An order is created PENDING (stock not yet
 * touched) and only deducted from Food.quantity when paid - each step re-validates stock so a
 * race between two users ordering the last of an item is caught instead of going negative.
 *
 * Once paid, an order moves through a merchant-facing fulfilment pipeline:
 * PAID -> CONFIRMED -> READY -> DISPATCHED, or PAID/CONFIRMED -> REJECTED (which restocks the
 * items, since payment already deducted them).
 */
@Service
public class OrderService {

    /** Forward-only fulfilment pipeline a paid order moves through. */
    private static final List<String> PIPELINE = List.of("PAID", "CONFIRMED", "READY", "DISPATCHED");

    @Autowired
    private OrderDao orderDao;

    @Autowired
    private FoodDao foodDao;

    @Transactional
    public Order createOrder(String username, List<OrderLineRequest> lines) {
        if (lines == null) {
            lines = new ArrayList<>();
        }
        List<OrderItem> items = new ArrayList<>();
        int total = 0;
        for (OrderLineRequest line : lines) {
            if (line.getQuantity() <= 0) {
                continue;
            }
            Food food = foodDao.findById(line.getFoodId())
                    .orElseThrow(() -> new NoSuchElementException("Unknown food item: " + line.getFoodId()));
            if (food.getQuantity() < line.getQuantity()) {
                throw new IllegalStateException("Not enough stock for " + food.getItem());
            }
            OrderItem item = new OrderItem();
            item.setFoodId(food.getId());
            item.setItemName(food.getItem());
            item.setQuantity(line.getQuantity());
            item.setPrice(food.getPrice());
            items.add(item);
            total += food.getPrice() * line.getQuantity();
        }
        if (items.isEmpty()) {
            throw new IllegalArgumentException("Order must contain at least one item");
        }

        Order order = new Order();
        order.setUsername(username);
        order.setOrderDate(LocalDateTime.now());
        order.setTotal(total);
        order.setStatus("PENDING");
        for (OrderItem item : items) {
            item.setOrder(order);
        }
        order.setItems(items);
        return orderDao.save(order);
    }

    @Transactional
    public Order payOrder(int orderId, String username) {
        Order order = orderDao.findById(orderId)
                .orElseThrow(() -> new NoSuchElementException("Order not found"));
        if (!order.getUsername().equals(username)) {
            throw new SecurityException("This order does not belong to the current user");
        }
        if (!"PENDING".equals(order.getStatus())) {
            throw new IllegalStateException("Order is not pending");
        }
        for (OrderItem item : order.getItems()) {
            Food food = foodDao.findById(item.getFoodId())
                    .orElseThrow(() -> new NoSuchElementException("Unknown food item: " + item.getFoodId()));
            if (food.getQuantity() < item.getQuantity()) {
                throw new IllegalStateException("Not enough stock for " + food.getItem());
            }
            food.setQuantity(food.getQuantity() - item.getQuantity());
            foodDao.save(food);
        }
        order.setStatus("PAID");
        return orderDao.save(order);
    }

    public List<Order> getOrderHistory(String username) {
        return orderDao.findByUsernameOrderByOrderDateDesc(username);
    }

    /** Customer-facing single-order lookup - only the order's own owner may view it. */
    public Order getOrderForUser(int orderId, String username) {
        Order order = orderDao.findById(orderId)
                .orElseThrow(() -> new NoSuchElementException("Order not found"));
        if (!order.getUsername().equals(username)) {
            throw new SecurityException("This order does not belong to the current user");
        }
        return order;
    }

    public List<Order> getAllOrders() {
        return orderDao.findAllByOrderByOrderDateDesc();
    }

    public Order getOrder(int orderId) {
        return orderDao.findById(orderId)
                .orElseThrow(() -> new NoSuchElementException("Order not found"));
    }

    @Transactional
    public Order updateStatus(int orderId, String newStatus) {
        Order order = orderDao.findById(orderId)
                .orElseThrow(() -> new NoSuchElementException("Order not found"));
        String current = order.getStatus();

        if ("REJECTED".equals(newStatus)) {
            if (!"PAID".equals(current) && !"CONFIRMED".equals(current)) {
                throw new IllegalStateException("An order can only be rejected before it's marked ready");
            }
            // Payment already deducted stock when the order was placed - give it back.
            for (OrderItem item : order.getItems()) {
                Food food = foodDao.findById(item.getFoodId())
                        .orElseThrow(() -> new NoSuchElementException("Unknown food item: " + item.getFoodId()));
                food.setQuantity(food.getQuantity() + item.getQuantity());
                foodDao.save(food);
            }
            order.setStatus("REJECTED");
            return orderDao.save(order);
        }

        int currentIndex = PIPELINE.indexOf(current);
        int newIndex = PIPELINE.indexOf(newStatus);
        if (currentIndex < 0 || newIndex != currentIndex + 1) {
            throw new IllegalStateException("Cannot move an order from " + current + " to " + newStatus);
        }
        order.setStatus(newStatus);
        return orderDao.save(order);
    }
}
