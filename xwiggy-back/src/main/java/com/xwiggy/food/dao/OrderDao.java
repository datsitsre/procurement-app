package com.xwiggy.food.dao;

import com.xwiggy.food.model.Order;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface OrderDao extends JpaRepository<Order, Integer> {
    List<Order> findByUsernameOrderByOrderDateDesc(String username);
    List<Order> findAllByOrderByOrderDateDesc();
}
