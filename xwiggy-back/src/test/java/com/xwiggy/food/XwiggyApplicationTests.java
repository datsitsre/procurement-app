package com.xwiggy.food;

import com.xwiggy.food.dao.CartService;
import com.xwiggy.food.dao.FoodService;
import com.xwiggy.food.dao.UserDao;
import com.xwiggy.food.dao.UserService;
import com.xwiggy.food.model.Food;
import com.xwiggy.food.model.Login;
import com.xwiggy.food.model.User;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
public class XwiggyApplicationTests {

    @Autowired
    UserDao userDao;

    @Autowired
    UserService userDaoImpl;

    @Autowired
    FoodService foodDao;

    @Autowired
    CartService cartDao;

    @Test
    public void contextLoads() {
        Login login = new Login();
        login.setUsername("user");
        login.setPassword("user");

        User user = userDaoImpl.validateUser(login);
        Assertions.assertEquals("Aman",user.getFirstname());
        Assertions.assertEquals("Kumar",user.getLastname());
        Assertions.assertEquals("aman@gmail.com",user.getEmail());
        Assertions.assertEquals("9585418",user.getPhone());
    }

    @Test
    public void checkFoodTable(){
        Food food = new Food();
        food.setId("abc");
        Food food1 = foodDao.validateFoodInfo(food.getId());
        Assertions.assertEquals("Coffee",food1.getItem());
        Assertions.assertEquals(50,food1.getPrice());
    }

    // The old cart/checkout flow (a single `cart` row keyed by array position) was replaced
    // by the Order/OrderItem model - see OrderService for the equivalent behavior.

}
