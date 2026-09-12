package com.xwiggy.food;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.xwiggy.food.controller.CartController;
import com.xwiggy.food.controller.FoodController;
import com.xwiggy.food.controller.LoginController;
import com.xwiggy.food.controller.RegistrationController;
import com.xwiggy.food.dao.CartService;
import com.xwiggy.food.dao.FoodService;
import com.xwiggy.food.dao.UserDao;
import com.xwiggy.food.dao.UserService;
import com.xwiggy.food.model.Login;
import com.xwiggy.food.model.User;
import com.xwiggy.food.security.JwtAuthFilter;
import com.xwiggy.food.security.JwtUtil;
import com.xwiggy.food.security.SecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// @WebMvcTest only scans controllers/converters/filters, not arbitrary @Configuration beans -
// import our actual security setup so this slice enforces the same rules as the real app,
// rather than falling back to Spring Boot's default (HTTP Basic + CSRF) security.
@WebMvcTest({LoginController.class,RegistrationController.class, FoodController.class, CartController.class})
@Import({SecurityConfig.class, JwtAuthFilter.class})
public class ApiTests {
    @Autowired
    private MockMvc mvc;

    @MockitoBean
    UserDao userDao;

    @MockitoBean
    UserService userDaoImpl;

    @MockitoBean
    FoodService foodDao;

    @MockitoBean
    CartService cartDao;

    @MockitoBean
    JwtUtil jwtUtil;

    /*@Test
    public void postLoginAPI() throws Exception
    {
        mvc.perform( MockMvcRequestBuilders
                .post("/login")
                .content(asJsonString(new Login("amank","abcd1234")))
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk());
    }
*/
    @Test
    public void getLoginApi() throws Exception{
        mvc.perform(MockMvcRequestBuilders
                    .get("/login")
                    .accept(MediaType.APPLICATION_JSON))
                    .andDo(print())
                    .andExpect(status().isOk());
    }

    @Test
    public void getRegisterApi() throws Exception{
        mvc.perform(MockMvcRequestBuilders
                .get("/api/register")
                .accept(MediaType.APPLICATION_JSON))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void postRegisterAPI() throws Exception
    {
        mvc.perform( MockMvcRequestBuilders
                .post("/register")
                .content(asJsonString(new User("aman","abcd1234","bbbb","bbbb","b@gmail.com","bbbb","9876543210",true)))
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk());
    }

    @Test
    public void postCheckUsernameApi() throws Exception{
        mvc.perform( MockMvcRequestBuilders
                .post("/checkUserName")
                .content("amank").contentType(MediaType.APPLICATION_JSON).accept(MediaType.APPLICATION_JSON)).andExpect(status().isOk());
    }

    @Test
    public void getMenuApi() throws Exception{
        when(jwtUtil.isTokenValid("test-token")).thenReturn(true);
        when(jwtUtil.extractUsername("test-token")).thenReturn("user");
        when(jwtUtil.extractRole("test-token")).thenReturn("USER");

        mvc.perform(MockMvcRequestBuilders
                .get("/menu")
                .header("Authorization", "Bearer test-token")
                .accept(MediaType.APPLICATION_JSON))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void getMenuApiRejectsUnauthenticated() throws Exception{
        mvc.perform(MockMvcRequestBuilders
                .get("/menu")
                .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden());
    }

    // The old /cart and /changeDB endpoints were replaced by OrderController's
    // /order and /order/{id}/pay - see OrderController for the equivalent flow.

    public static String asJsonString(final Object obj) {
        try {
            final ObjectMapper mapper = new ObjectMapper();
            final String jsonContent = mapper.writeValueAsString(obj);
            return jsonContent;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
